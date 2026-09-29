import { CategoriesService } from './categories.service';

describe('CategoriesService', () => {
  let service: CategoriesService;

  beforeEach(() => {
    service = new CategoriesService({} as never);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
