import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module.js';
import { DrawsModule } from './draws/draws.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [DbModule, HealthModule, DrawsModule],
})
export class AppModule {}
