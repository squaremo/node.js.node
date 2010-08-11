// External Term Format

// ** Utility functions

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
    this._ks = [parse_term];
}

var P = TermParser.prototype = new EventEmitter();

P.feed = function(buffer) {

    // new data nom nom
    // first: get a contiguous buffer, so we can try to continue.

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

    // The contract here is; if next can finish a whole term,
    // it returns.  If it can't, it throws a continuation.
    // So if we get a continuation, we have to wait for more data.
    var next = this._ks.pop();
    while (next) {
        try {
            next(this);
        }
        catch (maybeKont) {
            if (typeof(maybeKont) == 'function') {
                this._ks.push(maybeKont);
                return;
            }
            else {
                throw maybeKont;
            }
        }
        next = this._ks.pop();
    }
}

function parse_term(parser) {
    var buf = parser._buf;
    
    if (buf.length < 1) {
        throw parse_term;
    }

    var type = buf[0];
    parser._buf = buf.slice(1, buf.length);

    function parse_simple_or_throw(needed, parse_fun) {
        function kont(parser) {
            var buf = parser._buf;
            parser._ks.push(parse_term);
            var val = parse_fun(buf);
            parser._buf = buf.slice(needed, buf.length);
            parser.emit('term', val);
        }

        if (parser._buf.length < needed) {
            throw kont;
        }
        else {
            kont(parser);
        }
    }

    function parse_uint(buf) {
        return buf[0];
    }

    switch (type) {
    case SMALL_INTEGER_EXT:
        parse_simple_or_throw(1, parse_uint);
        break;
    }
}

exports.TermParser = TermParser;

/* Demo */

var tp = new TermParser();
var seven = new Buffer([97, 7]);
tp.on('term', function(term) { console.log("Term: " + term.toString()); });

tp.feed(seven);

var eleven0 = new Buffer([97]);
var eleven1 = new Buffer([11]);
tp.feed(eleven0);
tp.feed(eleven1);

tp.feed(seven);