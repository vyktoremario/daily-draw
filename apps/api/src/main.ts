import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
app.setGlobalPrefix('v1');
app.enableShutdownHooks();
const port = Number(process.env.API_PORT ?? 4000);
await app.listen(port, '0.0.0.0');
console.log(`api listening on http://localhost:${port}/v1`);
