import { ProductsController } from './products.controller';

describe('ProductsController', () => {
  let controller: ProductsController;

  beforeEach(() => {
    controller = new ProductsController({} as never);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
