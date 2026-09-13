import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import type { JwtPayload } from '../auth/types/jwt-payload.type';

import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';


@Injectable()
export class StockService {


    constructor(
        private prisma: PrismaService
    ){}



    async findAll(
        user: JwtPayload
    ){

        return this.prisma.product_stocks.findMany({

            where:{
                products:{
                    tenant_id:user.tenant_id
                }
            },

            include:{
                products:true,
                outlets:true
            }

        });

    }



    async adjustStock(
        user: JwtPayload,
        dto: CreateStockAdjustmentDto
    ){


        return this.prisma.$transaction(async(tx)=>{


            const stock = await tx.product_stocks.findUnique({

                where:{
                    outlet_id_product_id:{
                        outlet_id:dto.outlet_id,
                        product_id:dto.product_id
                    }
                }

            });



            let newStock = 0;



            if(stock){

                newStock = stock.stock;



                if(dto.adjustment_type === "ADD"){
                    newStock += dto.quantity;
                }



                if(dto.adjustment_type === "DEDUCT"){
                    newStock -= dto.quantity;
                }


                await tx.product_stocks.update({

                    where:{
                        id:stock.id
                    },

                    data:{
                        stock:newStock
                    }

                });


            }else{


                newStock = dto.quantity;


                await tx.product_stocks.create({

                    data:{

                        outlet_id:dto.outlet_id,

                        product_id:dto.product_id,

                        stock:newStock

                    }

                });


            }



            await tx.stock_movements.create({

                data:{

                    tenant_id:user.tenant_id,

                    outlet_id:dto.outlet_id,

                    product_id:dto.product_id,

                    user_id:user.sub,

                    type:dto.adjustment_type,

                    quantity:dto.quantity,

                    reason:dto.reason

                }

            });



            return {
                message:"Stock updated",
                current_stock:newStock
            };


        });


    }


}