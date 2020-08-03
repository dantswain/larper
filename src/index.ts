import { Larper, LarperOptions, Middleware } from './larper';

export {
  Larp, Larper, LarperOptions, LarpRequest,
} from './larper';

export function larper(upstream: string, options: LarperOptions): Middleware {
  const theLarper = new Larper(upstream, options);
  return theLarper.larp.bind(theLarper);
}
