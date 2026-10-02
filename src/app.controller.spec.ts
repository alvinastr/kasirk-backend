import { AppController } from './app.controller';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(() => {
    appController = new AppController();
  });

  describe('getHealth', () => {
    it('should return minimal health status', () => {
      expect(appController.getHealth()).toEqual({ status: 'ok' });
    });

    it('should not expose tenant or business data', () => {
      const response = appController.getHealth();

      expect(Array.isArray(response)).toBe(false);
      expect(Object.keys(response)).toEqual(['status']);
      expect(JSON.stringify(response)).not.toMatch(
        /tenant|store|user|customer|product|transaction|address|created_at|database|env|version|path/i,
      );
    });
  });
});
