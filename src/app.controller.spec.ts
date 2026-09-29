import { AppController } from './app.controller';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(() => {
    appController = new AppController({
      tenants: { findMany: async () => [] },
    } as never);
  });

  describe('testDatabase', () => {
    it('should return tenants', async () => {
      await expect(appController.testDatabase()).resolves.toEqual([]);
    });
  });
});
