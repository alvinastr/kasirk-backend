import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

@ApiTags('System')
@Controller()
export class AppController {
  // constructor(private readonly appService: AppService) {}

  // @Get()
  // getHello(): string {
  //   return this.appService.getHello();
  // }
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({
    summary: 'Database connectivity probe',
    description: 'Public endpoint that queries all tenants to verify database connectivity. Used for health checks and deployment verification.',
  })
  async testDatabase(){
    return this.prisma.tenants.findMany();
  }
}
