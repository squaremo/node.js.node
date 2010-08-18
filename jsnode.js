// The aim here is to support the distribution protocol.

var debug = function(str) {
}
if (process.env.DEBUG) {
    debug = function(str) {
        console.log(str);
    }
}

var net = require('net');
var EventEmitter = require('events').EventEmitter;
var EPMD = require('./epmd').EPMD;
var Buffer = require('buffer').Buffer;

var etf = require('./etf'),
read_int = etf.read_int,
write_int = etf.write_int,
read_string = etf.read_string,
write_string = etf.write_string,
buf_to_string = etf.buf_to_string;

var DFLAG_PUBLISHED = 1;
var DFLAG_ATOM_CACHE = 2;
var DFLAG_EXTENDED_REFERENCES = 4;
var DFLAG_DIST_MONITOR = 8;
var DFLAG_FUN_TAGS = 0x10;
var DFLAG_DIST_MONITOR_NAME = 0x20;
var DFLAG_HIDDEN_ATOM_CACHE = 0x40;
var DFLAG_NEW_FUN_TAGS = 0x80;
var DFLAG_EXTENDED_PIDS_PORTS = 0x100;
var DFLAG_EXPORT_PTR_TAG = 0x200;
var DFLAG_BIT_BINARIES = 0x400;
var DFLAG_NEW_FLOATS = 0x800;
var DFLAG_UNICODE_IO = 0x1000;
var DFLAG_DIST_HDR_ATOM_CACHE = 0x2000;
var DFLAG_SMALL_ATOM_TAGS =  0x4000;

var PROTOCOL_FLAGS =
//    DFLAG_PUBLISHED | // node visibility?
    DFLAG_EXTENDED_REFERENCES |
    DFLAG_EXTENDED_PIDS_PORTS |
    DFLAG_DIST_HDR_ATOM_CACHE |
    DFLAG_SMALL_ATOM_TAGS;

var PROTOCOL_VERSION = 5;  // latest is 6 though?

// http://github.com/erlang/otp/blob/dev/lib/kernel/internal_doc/distribution_handshake.txt
// is the handshake documentation;
// http://blog.listincomprehension.com/2010/03/spoofing-erlang-distribution-protocol.html
// is also a great help.

function Connection(node, stream) {
    this._node = node;
    this._stream = stream;
}

(function (C) {
    var P = C.prototype;

    P.handle = function(data) {
        this._handle(data);
    }

// e.g., <<0,16,110,0,5,0,0,127,253,104,101,108,108,111,64,99,105,100>>
    function handshake(data) {
        debug("recv handshake: "+buf_to_string(data));
        var len = read_int(data, 0, 2);
        if (data[2] != 110) { // 'n'
            throw "Unexpected data; expected handshake, got " + buf_to_string(data);
        }
        var versionlow = read_int(data, 3, 1);
        var versionhigh = read_int(data, 4, 1);
        if (versionlow > PROTOCOL_VERSION || PROTOCOL_VERSION > versionhigh) {
            throw "Protocol version " + PROTOCOL_VERSION + " not supported";
        }
        var flags = read_int(data, 5, 4);
        var name = read_string(data, 9, len-7); // len does not count first two
        debug("Handshake from " + name +
              " (versions "+versionlow+"-"+versionhigh+"," +
              " flags "+flags+")");
        this._connected_node = {'node': name, 'flags': flags};
        //this._node.emit('handshake', this._connected_node);
        this._handle = recv_challenge;
        send_status(this._stream);
        // We'll use Math.random, which we can hope is a decently
        // random source. We need 32 bits; Math.random gives us up to
        // 16 sigfigs; we need 4 bytes
        this._challenge = Math.floor(Math.random() * 4294967296);
        send_challenge(this._stream, this._node.name() + '@localhost', // FIXME
                       this._challenge);
    }

    function send_status(stream) {
        var buf = new Buffer(5);
        write_int(buf, 3, 0, 2);
        write_string(buf, 'sok', 2);
        debug("snd status: " + buf_to_string(buf));
        stream.write(buf);
    }

    function send_challenge(stream, nodename, challenge) {
        var buf = new Buffer(2 + 1 + 2 + 4 + 4 + nodename.length);
        write_int(buf, buf.length - 2, 0, 2);
        write_string(buf, 'n', 2);
        write_int(buf, PROTOCOL_VERSION, 3, 2); // 0,5
        // FIXME appropriate flags
        write_int(buf, PROTOCOL_FLAGS, 5, 4);
        write_int(buf, challenge, 9, 4);
        write_string(buf, nodename, 13);
        debug("snd challenge: "+buf_to_string(buf));
        stream.write(buf);
    }

    function send_response(stream, cookie, challenge) {
        var hash = require('crypto').createHash('md5');
        debug("Sending for cookie="+cookie+", challenge="+challenge);
        hash.update(cookie);
        hash.update(challenge.toString());
        var buf = new Buffer(19);
        write_int(buf, 17, 0, 2);
        buf[2] = 97; // 'a'
        buf.write(hash.digest('binary'), 3, 'binary');
        debug("snd answer: " + buf_to_string(buf));
        stream.write(buf);
    }

    function recv_challenge(data) {
        debug("recv challenge: " + buf_to_string(data));
        var hash = require('crypto').createHash('md5');
        hash.update(this._node._cookie);
        hash.update(this._challenge.toString());
        var answer = new Buffer(16);
        var digest = hash.digest('binary');
        answer.write(digest, 0, 'binary'); // FIXME binary is out of style
        var len = read_int(data, 0, 2);
        if (data[2] != 114) { // 'r'
            throw "Unexpected data; expected challenge response, got " +
                buf_to_string(data);
        }
        var response = data.slice(7, 23);
        for (var i=0; i<16; i++) {
            if (answer[i] != response[i]) {
                debug(buf_to_string(response) + " != " +
                      buf_to_string(answer));
                throw "response does not match hash";
            }
        }
        var counterchallenge = read_int(data, 3, 4);
        this._node.emit('connect', this._connected_node);
        this._handle = emit;
        send_response(this._stream, this._node._cookie, counterchallenge);
    }

    function emit(data) {
        this._node.emit('data', data, this._connected_node);
    }
    
    P.connect = function() {
        this._handle = handshake;
    }

    P.disconnect = function() {
        this._node.emit('disconnect', this);
    }

})(Connection);

 function Dist(nodename, port, cookie) {
    
    EventEmitter.call(this);
    this._name = nodename;
    this._port = port;
    this._cookie = cookie;
}

(function(D) {
    var P = D.prototype = new EventEmitter();

    P.cookie = function() {
        return this._cookie;
    }

    P.name = function() {
        return this._name;
    }

    P.create = function() {
        var epmd = new EPMD({});
        var node = this;
        epmd.register(
            node._name, node._port,
            function(epmd, args) {
                node.emit('registered');
                var dist = net.createServer(function(stream) {
                    var conn = new Connection(node, stream);
                    // TODO register it?
                    stream.on('connect', function() {
                        conn.connect();
                    });
                    stream.on('data', function(data) {
                        conn.handle(data);
                    });
                    stream.on('end', function() {
                        conn.disconnect();
                        node.emit('endConnection' + stream);
                    });
                });
                dist.listen(node._port);
            });
    };
}(Dist));

// DEMO

var cookie = process.env.COOKIE;

var n = new Dist('node3', 12345, cookie);
n.on('endConnection', function(stream) {
    connnection.log('End connection: ' + stream.remoteAddress);
});
n.on('data', function(data, from) {
    console.log("From: "+from+": "+buf_to_string(data));
});

n.create();
