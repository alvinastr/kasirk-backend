import { AuthController } from './auth.controller';

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(() => {
    controller = new AuthController({} as never);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
