import { StockController } from './stock.controller';

describe('StockController', () => {
  let controller: StockController;

  beforeEach(() => {
    controller = new StockController({} as never);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
