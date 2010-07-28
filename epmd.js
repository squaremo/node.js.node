var net = require('net');
var buffer = require('buffer');


var HIDDEN = 72;
var PROTOCOL = 0;
var HIGHEST_VERSION = 5, LOWEST_VERSION = 5;
var ALIVE2_REQ = 120;
var ALIVE2_RESP = 121;

var EventEmitter = require('events').EventEmitter;

function EPMD(args) {

    //    EventEmitter.call(this);
    this.host = args.host || "localhost";
    this.port = args.port || 4369;
}

(function(E) {

    var P = E.prototype;
    
    // kont :: epmd x node -> () ;; doesn't return
    P.register = function(nodename, port, kont) {
        // The max of any message we'll send is that for
        // ALIVE2_REQ:
        // 1  	2  	1  	1  	2  	2  	2  	Nlen  	2  	Elen
        // 120 	PortNo 	NodeType 	Protocol 	HighestVersion 	LowestVersion 	Nlen 	NodeName 	Elen 	Extra
        // = 2 + 11 + nodename.length + 2 (assuming no extra)
        var sendbuf = new buffer.Buffer(15 + nodename.length);
        var conn = this._connection = net.createConnection(this.port, this.host);
        conn.on('connect', function() {
            send_alive2_req(sendbuf, conn, nodename, port);
        });
        conn.on('data', function(data) {
            console.log('Received ' + buf_to_string(data, 0, data.length));
        });
    }
})(EPMD);

function writeInt(buf, num, offset, size) {
    // always big-endian
    for (var i = offset + size - 1; i >= offset; i--) {
        buf[i] = num & 0xFF;
        num >>= 8;
    }
}

// Write the length of the req in the first two bytes
function writeLength(buf, length) {
    writeInt(buf, length, 0, 2);
}

function writeString(buf, str, offset) {
    buf.write(str, offset, 'ascii');
}

function buf_to_string(buf, start, end) {
    var str = '<<';
    for (var i=start; i < end; i++) {
        str += buf[i].toString();
        if (i < end - 1) str += ','
    }
    return str +'>>';
}

function debug_req(buf, start, end) {
    console.log('Sending ' + buf_to_string(buf, start, end));
}

function send_req(buf, conn, start, end) {
    debug_req(buf, start, end);
    var slice = buf.slice(start, end);
    conn.write(slice);
}

function send_alive2_req(sendbuf, conn, nodename, port) {
    var length = 13 + nodename.length;
    writeLength(sendbuf, length);
    var offset = 2;
    sendbuf[offset++] = ALIVE2_REQ;
    writeInt(sendbuf, port, offset, 2); offset +=2;
    sendbuf[offset++] = HIDDEN;
    sendbuf[offset++] = PROTOCOL;
    writeInt(sendbuf, HIGHEST_VERSION, offset, 2); offset += 2;
    writeInt(sendbuf, LOWEST_VERSION, offset, 2); offset += 2;
    writeInt(sendbuf, nodename.length, offset, 2); offset += 2;
    writeString(sendbuf, nodename, offset); offset += nodename.length;
    // no extra.  what would it be?
    writeInt(sendbuf, 0, offset, 2); offset +=2 ;
    send_req(sendbuf, conn, 0, offset);
}

new EPMD({}).register('node1', 5555);
