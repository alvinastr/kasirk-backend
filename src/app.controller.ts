import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('System')
@Controller()
export class AppController {
  @Get()
  @ApiOperation({
    summary: 'Health check',
    description: 'Public endpoint that returns a minimal health status. Does not expose database records or environment details.',
  })
  @ApiOkResponse({
    description: 'Minimal service health response.',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
      },
      required: ['status'],
    },
  })
  getHealth(): { status: string } {
    return { status: 'ok' };
  }
}
