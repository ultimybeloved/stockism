// Backend tests load modules through Node's own require (createRequire), which
// cannot read TypeScript. tsx's hook teaches it to, so a test can require a
// module whether or not it has been converted yet.
import { register } from 'tsx/cjs/api';

register();
