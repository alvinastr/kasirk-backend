import { StockService } from './stock.service';

describe('StockService', () => {
  let service: StockService;

  beforeEach(() => {
    service = new StockService({} as never);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
