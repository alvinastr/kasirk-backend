import { OutletsService } from './outlets.service';

describe('OutletsService', () => {
  let service: OutletsService;

  beforeEach(() => {
    service = new OutletsService({} as never);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
