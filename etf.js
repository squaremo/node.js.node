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

// shifting bits will give us signed ints
function read_int(buf, offset, size) {
    var res = 0;
    for (var i = 0; i < size; i++) {
        res += buf[offset+i] * Math.pow(256, size - i - 1);
    }
    return res;
}

function read_string(buf, offset, length) {
    return buf.toString('ascii', offset, offset+length);
}

// Handy elsewhere
exports.write_int = write_int;
exports.write_string = write_string;
exports.buf_to_string = buf_to_string;
exports.read_int = read_int;
exports.read_string = read_string;

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
    this._atoms = {};
}

(function(ParserClass) {
    var P = ParserClass.prototype = new EventEmitter();
    
    P.emitTerm = function(value) {
        this.emit('term', value);
    }
    
    P.emitCommand = function(val) {
        //message = message || 'undefined';
        this.emit('command', val);
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
    
    P.atomIndexSet = function(entries) {
        this._atomindex = entries;
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var addr = (entry.segment << 8) | entry.index;
            this._atoms[addr] = entry.atom;
        }
    }

    P.atomIndexLookup = function(index) {
        var entry = this._atomindex[index];
        if (entry['new']) {
            return entry.atom;
        }
        else {
            return this._atoms[(entry.segment << 8) | entry.index];
        }
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
            //debug("(stack depth: " + this._ks.length + ")");
            var next = this.pop() || topK;
            //debug("Continuation: ");
            //debug(next.toString());
            try {
                var val = next(this, this._val);
                debug("Value: " + val);
                this._val = val;
            }
            catch (maybeKont) {
                if (typeof(maybeKont) == 'function') {
                    this.push(maybeKont);
                    //debug("thrown k");
                    return;
                }
                else {
                    debug("Fatal: " +maybeKont);
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

        function emitTerm(parser, val) {
            return parse_term(parser, function(parser, val) {
                parser.emitTerm(val);
                return null;
            });
        }

        function emitCommand(parser, val) {
            return parse_dist_message(parser, function(parser, val) {
                if (null != val) parser.emitCommand(val);
                return null;
            });
        }
        this._parse(emitCommand);
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
        //debug("Simple: "+val);
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
    
    debug("Tuple, size " + size);
    if (size==0) {
        return kont(parser, {'tuple': [], 'length': 0});
    }
    
    function read_rest_k(count, accum) {
        return function(parser, val) {
            debug("Tuple value: " + val);
            accum.push(val);
            if (count==1) {
                return {'tuple': accum, 'length': size};
            }
            else {
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
    case ATOM_CACHE_REF:
        return read_simple_or_throw(parser, 1, function(buf) {
            var index = read_uint8(buf);
            var lookedup = parser.atomIndexLookup(index);
            debug("Atom lookup, index " + index + ", value '"+ lookedup+"'");
            return lookedup;
        }, kont);
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
        return parse_byte_sized(parser, 1,
                               function(x){return x.toString()}, kont);
    case ATOM_EXT:
        return parse_byte_sized(parser, 2,
                               function(x){return x.toString()}, kont);
    case FUN_EXT:
    case NEW_FUN_EXT:
    case EXPORT_EXT:
    case BIT_BINARY_EXT:
    case NEW_FLOAT_EXT:
        throw "Unimplemented";
    }
}

var commands = {};
function def_command(ind, command) {
    commands[command] = ind; commands[ind] = command;
}
def_command("SEND", 1);
def_command("LINK", 2);
def_command("EXIT", 3);
def_command("UNLINK", 4);
def_command("NODE_LINK", 5);
def_command("REG_SEND", 6);
def_command("GROUP_LEADER", 7);
def_command("EXIT2", 8);
def_command("SEND_TT", 12);
def_command("EXIT_TT", 13);
def_command("REG_SEND_TT", 16);
def_command("EXIT2_TT", 18);
def_command("MONITOR_P", 19);
def_command("DEMONITOR_P", 20);
def_command("MONITOR_P_EXIT", 21);

function parse_dist_message(parser, kont) {
    // 4 dist n m
    if (parser.available() < 4) {
        throw function(parser) {
            return parse_dist_message(parser, kont);
        };
    }
    var len = read_uint32(parser.buf());
    debug("Message length: " + len);
    parser.advance(4);
    // 0-length frames are sent (I think as heartbeats)
    if (len == 0) {
        return kont(parser, null);
    }
    parser.push(kont);
    parser.push(function(parser, atomCache) {
        debug("Atom cache: " + require('sys').inspect(atomCache));
        parser.atomIndexSet(atomCache);

        return parse_term(parser, function(parser, controlMessage) {
            // controlMessage is supposed to be a tuple
            var control = controlMessage.tuple[0];
            // patch in the string version
            controlMessage.tuple[0] = commands[control];
            switch (control) {
            case commands.SEND:
            case commands.REG_SEND:
            case commands.SEND_TT:
            case commands.REG_SEND_TT:
                return parse_term(parser, function(parser, message) {
                    return {'control': controlMessage, 'message': message};
                });
            default:
                return {'control': controlMessage};
            }
        });
    });
    return parse_dist_header(parser);
}

// <<0,0,0,113, % length
//   131,68,5, % dist version and atom cache length
//   137,222,9, % atom cache flags (5 / 2 + 1)
//   37,10,110,101,116,95,107,101,114,110,101,108,5,0,109,9,104,101,108,108,111,64,99,105,100,146,7,105,115,95,97,117,116,104,136,9,36,103,101,110,95,99,97,108,108,104,4,97,6,103,82,2,0,0,1,27,0,0,0,0,1,82,1,82,0,104,3,82,4,104,2,103,82,2,0,0,1,27,0,0,0,0,1,114,0,3,82,2,1,0,0,3,153,0,0,0,0,0,0,0,0,104,2,82,3,82,2>>
function parse_dist_header(parser) {
    if (parser.available() < 3) {
        throw parse_dist_header;
    }
    var eq131then68 = read_int(parser.buf(), 0, 2);
    if ((eq131then68 >>> 8) != 131 ||
        (eq131then68 & 0xff) != 68) {
        throw "Expected bytes <<131, 68>>, got "+ eq131then68;
    }
    // Now, atom cache flags, 4 bits for each cache ref
    // plus 4 bits for overall (long atoms flag, effectively)
    var aclen = read_int(parser.buf(), 2, 1);
    parser.advance(3);
    // Just jump; this isn't going to be nested
    if (aclen > 0) {
        return parse_atom_cache(parser, aclen);
    }
    else {
        return [];
    }
}

function parse_atom_cache(parser, num) {
    var flagsLen = Math.floor(num / 2) + 1;
    if (parser.available() < flagsLen) {
        throw function(parser, value) {
            return parse_atom_cache(parser, num);
        };
    }
    
    var buf = parser.buf();
    var entries = [];
    for (var i=0; i < num; i++) {
        var f =  buf[Math.floor(i/2)];
        f = (i % 2 == 0) ? f & 0x0f : f >>> 4;
        entries[i] = {'new': f & 0x08, 'segment': f & 0x07};
    }
    var last = buf[flagsLen - 1];
    // if the num is even, the last index will be odd
    // and so the "overall" flags will be in the least sig
    //  bits; otherwise, most sig bits. 
    last = (num % 2 == 0) ? last & 0x0f : last >>> 4;
    debug("Last: " + last)
    var atomLenSize = (last & 0x01) ? 2 : 1;
    
    parser.advance(flagsLen);

    // FIXME hideous mutation
    // We cheat rather a lot here by mutating the entries,
    // and returning it knowing that if we're not done
    // we'll be given it back again.
    function read_rest_k(i) {
        return function(parser) {
            if (i < num) {
                var entry = entries[i];
                if (entry['new'] != 0) {
                    debug("New atom");
                    if (parser.available() < atomLenSize + 1) {
                        throw read_rest_k(i);
                    }
                    entry['index'] = read_int(parser.buf(), 0, 1);
                    var len = read_int(parser.buf(), 1, atomLenSize);
                    debug("atom len " + len);
                    if (parser.available() < (len + atomLenSize + 1)) {
                        throw read_rest_k(i);
                    }
                    var atom = read_string(parser.buf(), atomLenSize + 1, len);
                    entry['atom'] = atom;
                    parser.advance(atomLenSize + 1 + len);
                }
                else {
                    if (parser.available() < 1) {
                        throw read_rest_k(i);
                    }
                    entry['index'] = read_int(parser.buf(), 0, 1);
                    parser.advance(1);
                }
                parser.push(read_rest_k(i + 1));
                return entries;
            }
            else {
                debug(" All done ");
                return entries;
            }
        }
    }
    return read_rest_k(0)(parser);
}

exports.TermParser = TermParser;

/* Demo */

// Command parsing

/*
var com = new Buffer(
    [0,0,0,113, // length
     131,68,5, // dist version and atom cache length
     137,222,9, // atom cache flags (5 / 2 + 1)
     37,10,110,101,116,95,107,101,114,110,101,108,5,0,109,9,104,101,108,108,111,
     64,99,105,100,146,7,105,115,95,97,117,116,104,136,9,36,103,101,110,95,99,97,
     108,108,104,4,97,6,103,82,2,0,0,1,27,0,0,0,0,1,82,1,82,0,104,3,82,4,104,2,
     103,82,2,0,0,1,27,0,0,0,0,1,114,0,3,82,2,1,0,0,3,153,0,0,0,0,0,0,0,0,104,2,
     82,3,82,2]);

var cp = new TermParser();
cp.on('command', function(command) {
    console.log("Command: " + require('sys').inspect(command, false, 0));
});

cp.feed(com);
*/

/*
var tp = new TermParser();
tp.on('term', function(term) { console.log("Term: " + require('sys').inspect(term)); });

/*
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
*/
