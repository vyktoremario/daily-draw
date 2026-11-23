import { Module } from '@nestjs/common';
import { DrawsController } from './draws.controller.js';
import { DrawsService } from './draws.service.js';

@Module({
  controllers: [DrawsController],
  providers: [DrawsService],
})
export class DrawsModule {}
