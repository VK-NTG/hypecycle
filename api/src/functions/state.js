const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');

const CONN      = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER = process.env.BLOB_CONTAINER || 'hypecycle';
const BLOB_NAME = process.env.BLOB_NAME || 'state.json';

function getBlobClient() {
  if (!CONN) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING mangler i application settings');
  }
  const service = BlobServiceClient.fromConnectionString(CONN);
  const container = service.getContainerClient(CONTAINER);
  return { container, blob: container.getBlockBlobClient(BLOB_NAME) };
}

async function streamToString(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    readable.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    readable.on('error', reject);
  });
}

app.http('state', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'state',
  handler: async (request, context) => {
    let container, blob;
    try {
      ({ container, blob } = getBlobClient());
    } catch (e) {
      context.error(e);
      return { status: 500, jsonBody: { error: 'config', message: e.message } };
    }

    // GET – hent gemt tilstand (alle må læse, så forsiden kan vises)
    if (request.method === 'GET') {
      try {
        const download = await blob.download();
        const body = await streamToString(download.readableStreamBody);
        return { status: 200, headers: { 'Content-Type': 'application/json' }, body };
      } catch (e) {
        if (e.statusCode === 404) {
          // Ingen gemt tilstand endnu – appen falder tilbage på sit udgangspunkt
          return { status: 404, jsonBody: { error: 'no-state' } };
        }
        context.error(e);
        return { status: 500, jsonBody: { error: 'read-failed' } };
      }
    }

    // POST – gem tilstand (bør beskyttes, se README → Sikring)
    try {
      const text = await request.text();
      JSON.parse(text); // valider at det er gyldig JSON
      await container.createIfNotExists();
      await blob.upload(text, Buffer.byteLength(text), {
        blobHTTPHeaders: { blobContentType: 'application/json' }
      });
      return { status: 200, jsonBody: { ok: true } };
    } catch (e) {
      context.error(e);
      return { status: 400, jsonBody: { error: 'write-failed', message: e.message } };
    }
  }
});
