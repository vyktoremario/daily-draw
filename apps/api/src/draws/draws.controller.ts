import { Controller, Get, Inject, NotFoundException } from '@nestjs/common';
import { DrawsService } from './draws.service.js';

// Constructor injection uses explicit @Inject(...) everywhere: `tsx` (esbuild) in dev does not
// emit decorator metadata, so Nest cannot infer types from constructor parameters.
@Controller()
export class DrawsController {
  constructor(@Inject(DrawsService) private readonly draws: DrawsService) {}

  @Get('rules')
  rules() {
    return this.draws.rules();
  }

  @Get('draws/current')
  async current() {
    const draw = await this.draws.current();
    if (!draw)
      throw new NotFoundException({
        error: { code: 'NO_OPEN_DRAW', message: 'No draw is open right now' },
      });
    return draw;
  }
}
