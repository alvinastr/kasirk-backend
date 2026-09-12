import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';


@Injectable()
export class ProductsService {

 constructor(
   private prisma: PrismaService
 ){}

 async findAll(
   tenant_id:string
 ){

   return this.prisma.products.findMany({
     where:{
       tenant_id
     }
   });

 }

}