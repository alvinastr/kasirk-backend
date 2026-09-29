import { ProductsService } from './products.service';

describe('ProductsService', () => {
  let service: ProductsService;

  beforeEach(() => {
    service = new ProductsService({} as never);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
