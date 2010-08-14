// External Term Format

// ** Utility functions

var debug = function(str) {
}
if (process.env.DEBUG) {
    debug = function(str) {
        console.log(str);
    }
}

function writeInt(buf, num, offset, size) {
    // always big-endian
    for (var i = offset + size - 1; i >= offset; i--) {
        buf[i] = num & 0xFF;
        num >>= 8;
    }
}

function writeString(buf, str, offset) {
    buf.write(str, offset, 'ascii');
}

function buf_to_string(buf, start, end) {
    var str = '<<';
    var start = start || 0;
    var end = end || buf.length;
    for (var i=start; i < end; i++) {
        str += buf[i].toString();
        if (i < end - 1) str += ','
    }
    return str +'>>';
}

function readInt(buf, offset, size) {
    var res = 0;
    for (var i = 0; i < size; i++) {
        res += buf[offset+i] << (size - i - 1) * 8;
    }
    return res;
}

exports.writeInt = writeInt;
exports.writeString = writeString;
exports.buf_to_string = buf_to_string;
exports.readInt = readInt;

// ** Parser

var EventEmitter = require('events').EventEmitter;
var Buffer = require('buffer').Buffer;

var VERSION = 131,

NEW_FLOAT_EXT = 70,
// gap
BIT_BINARY_EXT = 77,
// gap
ATOM_CACHE_REF = 82,
// gap
SMALL_INTEGER_EXT = 97,
INTEGER_EXT = 98,
FLOAT_EXT = 99,
ATOM_EXT = 100,
REFERENCE_EXT = 101,
PORT_EXT = 102,
PID_EXT = 103,
SMALL_TUPLE_EXT = 104,
LARGE_TUPLE_EXT = 105,
NIL_EXT = 106,
STRING_EXT = 107,
LIST_EXT = 108,
BINARY_EXT = 109,
SMALL_BIG_EXT = 110,
LARGE_BIG_EXT = 111,
NEW_FUN_EXT = 112,
EXPORT_EXT = 113,
NEW_REFERENCE_EXT = 114,
SMALL_ATOM_EXT = 115,
// and gap
FUN_EXT = 117
;

function TermParser() {
    EventEmitter.call(this);
    this._buf = null;
    this._ks = [];
    this._val = null;
}

var P = TermParser.prototype = new EventEmitter();

P.emitTerm = function(value) {
    this.emit('term', value);
}

P.advance = function(numBytes) {
    this._buf = this._buf.slice(numBytes, this._buf.length);
}

P.available = function() {
    return this._buf.length;
}

P.push = function(k) {
    this._ks.push(k);
}

P.pop = function() {
    return this._ks.pop();
}

P.buf = function() {
    return this._buf;
}

P.feed = function(buffer) {

    // new data nom nom
    // first: get a contiguous buffer, so we can try to continue.

    if (buffer.length < 1) return;

    if (!this._buf || this._buf.length == 0) {
        this._buf = buffer;
    }
    else {
        var bytesLeft = this._buf.length;
        // we need a new buffer at least this._buf - this._pos + buffer.size.
        // we'll just create a new one and let the old one
        // be collected
        var sizeNeeded = bytesLeft + buffer.length;
        var buf = new Buffer(sizeNeeded);
        this._buf.copy(buf, 0, 0);
        buffer.copy(buf, bytesLeft, 0);
        this._buf = buf;
    }

    // kont :: parser x value -> value
    // parse :: parser x kont -> value

    function emitVal(parser, val) {
        return parse_term(parser, function(parser, val) {
            parser.emitTerm(val);
            return null;
        });
    }

    while (true) {
        debug("(stack depth: " + this._ks.length + ")");
        var next = this.pop() || emitVal;
        debug("Continuation: ");
        debug(next.toString());
        try {
            var val = next(this, this._val);
            debug("Value: " + val);
            this._val = val;
        }
        catch (maybeKont) {
            if (typeof(maybeKont) == 'function') {
                this.push(maybeKont);
                debug("thrown k");
                return;
            }
            else {
                throw maybeKont;
            }
        }
    }
}

function read_simple_or_throw(parser, needed, read_fun, kont) {
    if (parser.available() < needed) {
        //debug("not enough")
        throw function(parser, val) {
            return read_simple_or_throw(parser, needed, read_fun, kont);
        }
    }
    else {
        parser.push(kont);
        var val = read_fun(parser.buf());
        parser.advance(needed);
        return val;
    }
}

function read_uint(buf) {
    return buf[0];
}

function parse_list(parser, kont) {
    if (parser.available() < 4) {
        throw function(parser, val) {
            return parse_list(parser, kont);
        }
    }
    var count = readInt(parser.buf(), 0, 4);
    parser.advance(4);

    function read_rest_k(count, accum) {
        debug("(count: "+count+"; accum:"+accum+")");
        return function(parser, val) {
            if (count==0) {
                accum.tl = val;
                return accum;
            }
            else {
                accum.push(val);
                return parse_term(parser, read_rest_k(count-1, accum));
            };
        }
    }
    parser.push(kont);
    return parse_term(parser, read_rest_k(count, []));
}

function parse_term(parser, kont) {
    debug(buf_to_string(parser.buf()));
    if (parser.available() < 1) {
        debug("not even enough for a type: ");
        throw function(parser) {
            return parse_term(parser, kont);
        }
    }

    var type = parser.buf()[0];
    parser.advance(1);

    switch (type) {
    case SMALL_INTEGER_EXT:
        return read_simple_or_throw(parser, 1, read_uint, kont);
    case NIL_EXT:
        // just call the continuation.
        // this will only be at the bottom of terms.
        debug("empty list");
        return kont(parser, []);
    case LIST_EXT:
        return parse_list(parser, kont);
    }
}

exports.TermParser = TermParser;

/* Demo */

var tp = new TermParser();
var seven = new Buffer([97, 7]);
tp.on('term', function(term) { console.log("Term: " + require('sys').inspect(term)); });

tp.feed(seven);
// -> Term: 7

var eleven0 = new Buffer([97]);
var eleven1 = new Buffer([11]);
tp.feed(eleven0);
tp.feed(eleven1);
// -> Term : 11

tp.feed(seven);
// -> Term: 7

var none = new Buffer([]);
tp.feed(none);
tp.feed(seven);
// -> Term: 7

var nil = new Buffer([106]);
tp.feed(nil);
// -> Term: []

var empty = new Buffer([108,0,0,0,0,106]);
tp.feed(empty);
// -> Term: []

var listfivesixseven = new Buffer([108, 0, 0, 0, 3, 97, 5, 97, 6, 97, 7, 106]); // FIXME tail
tp.feed(listfivesixseven);
// -> Term: [ 5, 6, 7 ]

var listfivesix0 = new Buffer([108, 0, 0, 0, 2, 97]);
var listfivesix1 = new Buffer([5, 97, 6, 106]);
tp.feed(listfivesix0);
tp.feed(listfivesix1);
// -> Term: [ 5, 6 ]

var improper = new Buffer([108, 0,0,0,1, 97,4, 97,5]);
tp.feed(improper);
