import { Test, TestingModule } from '@nestjs/testing';

export async function createUnitTestModule(
  moduleDef: Parameters<typeof Test.createTestingModule>[0],
): Promise<TestingModule> {
  return Test.createTestingModule(moduleDef).compile();
}

export async function createUnitTest<T>(
  serviceClass: new (...args: unknown[]) => T,
  providers: Record<string, unknown>,
): Promise<T> {
  const module = await Test.createTestingModule({
    providers: [
      serviceClass,
      ...Object.entries(providers).map(([token, value]) => ({
        provide: token,
        useValue: value,
      })),
    ],
  }).compile();

  return module.get<T>(serviceClass);
}

export function expectRejectsWith(
  promise: Promise<unknown>,
  errorClass: new (...args: unknown[]) => Error,
  message?: string | RegExp,
): Promise<void> {
  if (message) {
    return expect(promise).rejects.toThrow(message);
  }
  return expect(promise).rejects.toThrow(errorClass);
}

export function expectCalledWithMatch(mock: jest.Mock, expected: Record<string, unknown>): void {
  expect(mock).toHaveBeenCalled();
  const actual = mock.mock.calls[mock.mock.calls.length - 1][0];
  for (const [key, value] of Object.entries(expected)) {
    expect(actual[key]).toEqual(value);
  }
}
