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
    this._ks = [];
    this._val = null;
}

var P = TermParser.prototype = new EventEmitter();

P.emitTerm = function(value) {
    this.emit('term', value);
}

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

    // kont :: parser x value -> value
    // parse :: parser x kont -> value

    function emitVal(parser, val) {
        return parse_term(parser, function(parser, val) {
            parser.emitTerm(val);
            return null;
        });
    }

    while (true) {
        var next = this._ks.pop() || emitVal;
        //console.log("Continuation: ");
        //console.log(next.toString());
        try {
            var val = next(this, this._val);
            //console.log("Value: " + val);
            this._val = val;
        }
        catch (maybeKont) {
            if (typeof(maybeKont) == 'function') {
                this._ks.push(maybeKont);
                //console.log("thrown k");
                return;
            }
            else {
                throw maybeKont;
            }
        }
    }
}

function read_simple_or_throw(parser, needed, read_fun, kont) {
    if (parser._buf.length < needed) {
        //console.log("not enough")
        throw function(parser, val) {
            return read_simple_or_throw(parser, needed, read_fun, kont);
        }
    }
    else {
        parser._ks.push(kont);
        var val = read_fun(parser._buf);
        parser._buf = parser._buf.slice(needed, parser._buf.length);
        return val;
    }
}

function read_uint(buf) {
    return buf[0];
}

function parse_list(parser, kont) {
    if (parser._buf.length < 4) {
        throw parse_list;
    }
    var count = readInt(parser._buf, 0, 4);
}

function parse_term(parser, kont) {
    if (parser._buf.length < 1) {
        //console.log("not even enough for a type");
        throw function(parser) {
            return parse_term(parser, kont);
        }
    }

    var type = parser._buf[0];
    parser._buf = parser._buf.slice(1, parser._buf.length);

    switch (type) {
    case SMALL_INTEGER_EXT:
        return read_simple_or_throw(parser, 1, read_uint, kont);
    case NIL_EXT:
        // just recurse, this will only be at the bottom of terms
        return kont(parser, []);
    case LIST_EXT:
        return parse_list();
    }
}

exports.TermParser = TermParser;

/* Demo */

var tp = new TermParser();
var seven = new Buffer([97, 7]);
tp.on('term', function(term) { console.log("Term: " + term); });

tp.feed(seven);
// -> Term: 7

var eleven0 = new Buffer([97]);
var eleven1 = new Buffer([11]);
tp.feed(eleven0);
tp.feed(eleven1);
// -> Term : 11

tp.feed(seven);
// -> Term: 7
