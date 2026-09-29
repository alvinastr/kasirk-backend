import { CategoriesController } from './categories.controller';

describe('CategoriesController', () => {
  let controller: CategoriesController;

  beforeEach(() => {
    controller = new CategoriesController({} as never);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
