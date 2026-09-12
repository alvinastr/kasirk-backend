import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ProductsService } from './products.service';


@Controller('products')
export class ProductsController {

 constructor(
   private productsService: ProductsService
 ){}

 @UseGuards(JwtGuard)
 @Get()
 findAll(
   @CurrentUser() user:any
 ){
   return this.productsService.findAll(
      user.tenant_id
   );
 }

}