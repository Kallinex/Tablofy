import { SCOPES_KEY, Scopes } from '../decorators/scopes.decorator';

describe('Scopes decorator', () => {
  class Target {
    @Scopes('orders:read', 'orders:write')
    handler(): void {
      /* noop */
    }

    plain(): void {
      /* noop */
    }
  }

  it('publishes the metadata under the shared scopes key', () => {
    expect(SCOPES_KEY).toBe('scopes');
  });

  it('attaches the requested scopes to the handler', () => {
    expect(Reflect.getMetadata(SCOPES_KEY, Target.prototype.handler)).toEqual([
      'orders:read',
      'orders:write',
    ]);
  });

  it('leaves undecorated handlers without scope metadata', () => {
    expect(Reflect.getMetadata(SCOPES_KEY, Target.prototype.plain)).toBeUndefined();
  });

  it('preserves the declared order and duplicates of scopes', () => {
    class Dup {
      @Scopes('a', 'b', 'a')
      handler(): void {
        /* noop */
      }
    }

    expect(Reflect.getMetadata(SCOPES_KEY, Dup.prototype.handler)).toEqual(['a', 'b', 'a']);
  });

  it('accepts an empty scope list', () => {
    class Empty {
      @Scopes()
      handler(): void {
        /* noop */
      }
    }

    expect(Reflect.getMetadata(SCOPES_KEY, Empty.prototype.handler)).toEqual([]);
  });
});
