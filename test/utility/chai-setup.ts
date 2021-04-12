import { use, assert, expect } from 'chai';
import * as chaiEach from 'chai-each';
import * as chaiSubset from 'chai-subset';
import 'chai/register-should';
import * as sinon from 'sinon';
use(chaiEach);
use(chaiSubset);
export { expect, assert, sinon };
// Note: We use Node assert instead of chai-as-promised.
export { doesNotReject as assertResolves, rejects as assertRejects} from 'assert';