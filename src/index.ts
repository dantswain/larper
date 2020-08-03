import { Larper, LarperOptions, Middleware } from './larper';

export {
  Larp, Larper, LarperOptions,
} from './larper';

export function larper(upstream: string, options: LarperOptions): Middleware {
  const theLarper = new Larper(upstream, options);
  return theLarper.larp.bind(theLarper);
}
