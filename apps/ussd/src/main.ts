import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { defaultContext, handleUssd } from './menu.js';

interface AfricasTalkingUssdBody {
  sessionId: string;
  serviceCode: string;
  phoneNumber: string;
  text?: string;
}

const app = Fastify({ logger: true });
await app.register(formbody);

// TODO(R3): verify the request really comes from Africa's Talking (IP allow-list), keep
// session state in Redis, and fetch pool/results from the API instead of defaultContext.
app.post<{ Body: AfricasTalkingUssdBody }>('/ussd', async (req, reply) => {
  const result = handleUssd(req.body.text ?? '', defaultContext);
  reply.type('text/plain');
  return `${result.type} ${result.message}`;
});

app.get('/health', async () => ({ status: 'ok' }));

const port = Number(process.env.USSD_PORT ?? 4100);
await app.listen({ port, host: '0.0.0.0' });
