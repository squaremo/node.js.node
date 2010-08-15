// External Term Format

// ** Utility functions

var debug = function(str) {
}
if (process.env.DEBUG) {
    debug = function(str) {
        console.log(str);
    }
}

function write_int(buf, num, offset, size) {
    // always big-endian
    for (var i = offset + size - 1; i >= offset; i--) {
        buf[i] = num & 0xFF;
        num >>= 8;
    }
}

function write_string(buf, str, offset) {
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

function read_int(buf, offset, size) {
    var res = 0;
    for (var i = 0; i < size; i++) {
        res += buf[offset+i] << (size - i - 1) * 8;
    }
    return res;
}

// Handy elsewhere
exports.write_int = write_int;
exports.write_string = write_string;
exports.buf_to_string = buf_to_string;
exports.read_int = read_int;

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

(function(ParserClass) {
    var P = ParserClass.prototype = new EventEmitter();
    
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
    
    P._ensureBuffer = function(buffer) {
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
    }

    P._parse = function(topK) {
        while (true) {
            debug("(stack depth: " + this._ks.length + ")");
            var next = this.pop() || topK;
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

    P.feed = function(buffer) {
        
        // new data nom nom
        // first: get a contiguous buffer, so we can try to continue.
        this._ensureBuffer(buffer);

        // kont :: parser x value -> value

        function emitVal(parser, val) {
            return parse_term(parser, function(parser, val) {
                parser.emitTerm(val);
                return null;
            });
        }
        this._parse(emitVal);
    }
})(TermParser);

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

function read_uint8(buf) {
    return buf[0];
}

function read_uint32(buf) {
    return read_int(buf, 0, 4);
}

function read_float(buf) {
    // FIXME sketchy
    var rep = buf.toString('ascii', 0, 31);
    return parseFloat(rep);
}

function parse_noded(parser, size, read_func, kont) {
    return parse_term(parser, function(parser, val) {
        return read_simple_or_throw(parser, size, function(buf) {
            return read_func(val, buf);
        }, kont);
    });
}

function parse_reference(parser, kont) {
    return parse_noded(parser, 5, function(node, buf) {
        var id = read_uint32(buf, 0, 4);
        var creation = read_int(buf, 4, 1);
        return {'ref': {'node': node, 'id': id, 'creation': creation}};
    }, kont);
}

function parse_port(parser, kont) {
    return parse_noded(parser, 5, function(node, buf) {
        var id = read_uint32(buf, 0, 4);
        var creation = read_int(buf, 4, 1);
        return {'port': {'node': node, 'id': id, 'creation': creation}};
    }, kont);
}

function parse_pid(parser, kont) {
    return parse_noded(parser, 9, function(node, buf) {
        var id = read_int(buf, 0, 4);
        var serial = read_int(buf, 4, 4);
        var creation = read_int(buf, 8, 1);
        return {'pid': {'node': node, 'id': id,
                        'serial': serial, 'creation': creation}};
    }, kont);
}

function parse_list(parser, kont) {
    if (parser.available() < 4) {
        throw function(parser, val) {
            return parse_list(parser, kont);
        }
    }
    var count = read_int(parser.buf(), 0, 4);
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

function parse_tuple(sizeSize, parser, kont) {
    if (parser.available() < sizeSize) {
        throw function(parser, val) {
            return parse_tuple(sizeSize, parser, kont);
        }
    }
    var size = read_int(parser.buf(), 0, sizeSize);
    parser.advance(sizeSize);

    if (size==0) {
        return kont({'tuple': [], 'length': 0});
    }
    
    function read_rest_k(count, accum) {
        debug("(count: "+count+"; accum:"+accum+")");
        return function(parser, val) {
            if (count==1) {
                accum.push(val);
                return {'tuple': accum, 'length': size};
            }
            else {
                accum.push(val);
                return parse_term(parser, read_rest_k(count-1, accum));
            };
        }
    }
    parser.push(kont);
    return parse_term(parser, read_rest_k(size, []));
}

function parse_byte_sized(parser, sizeSize, read_fun, kont) {
    if (parser.available() < sizeSize) {
        throw function(parser, val) {
            parse_byte_sized(parser, sizeSize, read_fun, kont);
        }
    }
    var size = read_int(parser.buf(), 0, sizeSize);
    parser.advance(sizeSize);

    return read_simple_or_throw(parser, size, function(buf) {
        return read_fun(buf.slice(0, size));
    }, kont);
}

function parse_bignum(parser, sizeSize, kont) {
    if (parser.available() < sizeSize + 1) { // the 1 is the sign
        throw function(parser, val) {
            parse_bignum(parser, sizeSize, kont);
        }
    }
    var size = read_int(parser.buf(), 0, sizeSize);
    var sign = read_int(parser.buf(), sizeSize, 1);
    parser.advance(sizeSize + 1);
    
    return read_simple_or_throw(parser, size, function(buf) {
        var num = 0;
        for (var i=0; i < size; i++) {
            num |= (buf[i] << (8 * i));
        }
        return (sign==0) ? num : -num;
    }, kont);
}

function parse_new_ref(parser, kont) {
    //    (1) 2 N 1 4*Len
    if (parser.available() < 2) {
        throw function(parser, val) {
            parse_new_ref(parser, kont);
        }
    }
    var len = read_int(parser.buf(), 0, 2);
    var idSize = 4*len;
    debug("newref idsize: "+idSize);
    parser.advance(2);
    return parse_term(parser, function(parser, node) {
        function read_rest(buf) {
            var creation = read_uint8(parser.buf());
            var id = read_int(parser.buf(), 1, idSize);
            return {'ref': {'node': node, 'id': id, 'creation': creation}};
        }
        return read_simple_or_throw(parser, idSize+1, read_rest, kont);
    });
}

function parse_term(parser, kont) {
    debug("In buffer: "+buf_to_string(parser.buf()));
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
        return read_simple_or_throw(parser, 1, read_uint8, kont);
    case INTEGER_EXT:
        return read_simple_or_throw(parser, 4, read_uint32, kont);
    case FLOAT_EXT:
        return read_simple_or_throw(parser, 31, read_float, kont);
    case ATOM_EXT:
        return parse_byte_sized(parser, 2,
                               function(x){return x.toString()}, kont);
    case REFERENCE_EXT:
        return parse_reference(parser, kont);
    case PORT_EXT:
        return parse_port(parser, kont);
    case PID_EXT:
        return parse_pid(parser, kont);
    case SMALL_TUPLE_EXT:
        return parse_tuple(1, parser, kont);
    case LARGE_TUPLE_EXT:
        return parse_tuple(4, parser, kont);
    case NIL_EXT:
        // just call the continuation.
        // this will only be at the bottom of terms.
        return kont(parser, []);
    case STRING_EXT:
        return parse_byte_sized(parser, 2, function(x){return x}, kont);
    case LIST_EXT:
        return parse_list(parser, kont);
    case BINARY_EXT:
        return parse_byte_sized(parser, 4, function(x){return x}, kont);
    case SMALL_BIG_EXT:
        return parse_bignum(parser, 1, kont);
    case LARGE_BIG_EXT:
        return parse_bignum(parser, 4, kont);
    case NEW_REFERENCE_EXT:
        return parse_new_ref(parser, kont);
    case SMALL_ATOM_EXT:
    case ATOM_EXT:
        return parse_byte_sized(parser, 1,
                               function(x){return x.toString()}, kont);
    case FUN_EXT:
    case NEW_FUN_EXT:
    case EXPORT_EXT:
    case BIT_BINARY_EXT:
    case NEW_FLOAT_EXT:
        throw "Unimplemented";
    }
}

exports.TermParser = TermParser;

/* Demo */

var tp = new TermParser();
tp.on('term', function(term) { console.log("Term: " + require('sys').inspect(term)); });

var seven = new Buffer([97, 7]);

tp.feed(seven);
// -> Term: 7

var eleven0 = new Buffer([97]);
var eleven1 = new Buffer([11]);
tp.feed(eleven0);
tp.feed(eleven1);
// -> Term : 11

tp.feed(seven);
// -> Term: 7

var bigint = new Buffer([98, 0,0,1,44]);
tp.feed(bigint);
// -> Term: 300

var float = new Buffer([99, 49,46,50,51,52,53,54,48,48,48,48,48,48,48,48,48,
                        48,48,51,48,55,48,101,43,48,50,0,0,0,0,0]);
tp.feed(float);
// -> Term: 123.456

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
// -> Term: [4, tl: 5]

var nested = new Buffer([108, 0,0,0,2, 97,6, 108, 0,0,0,1, 97,7, 106, 106]);
tp.feed(nested);
// -> Term: [6, [7]]

// Tuples
var small = new Buffer([104, 3, 97,1, 97,2, 97,3]);
tp.feed(small);
// -> Term: {tuple: [1, 2, 3], length: 3}

var large = new Buffer([105, 0,0,0,3, 97,1, 97,2, 97,3]);
tp.feed(large);
// -> Term {tuple: [1,2,3], length: 3}

// Strings
var msg = "Hello World!";
var short = new Buffer(3 + Buffer.byteLength(msg));
short[0] = 107; short[1] = 0; short[2] = Buffer.byteLength(msg);
new Buffer(msg).copy(short, 3, 0);
tp.feed(short);
// -> Term: <buffer with bytes encoding "Hello World!">>

var short0 = short.slice(0, 6);
var short1 = short.slice(6, short.length);
tp.feed(short0);
tp.feed(short1);
// -> Term: as above

// Atoms
var atomatom = new Buffer([100,0,11, 104,101,108,108,111,95,119,111,114,108,100]);
tp.feed(atomatom);
// -> Term: 'hello world'

var smallatom = new Buffer([115, 11, 104,101,108,108,111,95,119,111,114,108,100])
tp.feed(smallatom);
// -> Term: 'hello world'

// Reference, Port, Pid
// NB the ID has restrictions on which bits can
// be set; I'm ignoring them for now.
var ref = new Buffer([101, 100,0,5,104,101,108,108,111, 0,0,1,44, 1]);
tp.feed(ref);
// -> Term: {'ref': {'node': 'hello', 'id': 300, 'creation': 1}}

var port = new Buffer([102, 100,0,5,104,101,108,108,111, 0,0,1,44, 1]);
tp.feed(port);
// -> Term: {'port': {'node': 'hello', 'id': 300, 'creation': 1}}

var pid = new Buffer([103, 100,0,5,104,101,108,108,111, 0,0,1,44, 0,0,1,45, 1]);
tp.feed(pid);
// -> Term: {'pid': {'node': 'hello', 'id': 300, 'serial': 301, 'creation': 1}}

var newref = new Buffer([114, 0,2,  100,0,5,104,101,108,108,111, 3, 0,0,0,0,0,0,1,44]);
tp.feed(newref);
// -> Term: {'ref': {'node': 'hello', 'id': 300, 'creation': 3}}

// Binary

var binary = new Buffer(23);
binary[0] = 109; binary[1] =0; binary[2] = 0; binary[3] = 0; binary[4] = 18;
for (var i = 0; i < 18; i++) binary[i+5] = i;
debug('Binary: ' + require('sys').inspect(binary));
tp.feed(binary.slice(0, 10));
tp.feed(binary.slice(10, 15));
tp.feed(binary.slice(15, 23));
// -> Term: <binary>

// bignums
// NB small-endian

var smallbig = new Buffer([110, 4, 0, 12,0,0,0]);
tp.feed(smallbig);
// -> Term: 12

var largebig = new Buffer([111, 0,0,0,4, 1, 12,0,0,0]);
tp.feed(largebig);
// -> Term: -12
