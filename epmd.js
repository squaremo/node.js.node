var net = require('net');
var buffer = require('buffer');


var NOT_HIDDEN = 77;
var PROTOCOL = 0;
var HIGHEST_VERSION = 5, LOWEST_VERSION = 5;
var ALIVE2_REQ = 120;
var ALIVE2_RESP = 121;

var codec = require('./codec'),
writeInt = codec.writeInt,
writeString = codec.writeString,
buf_to_string = codec.buf_to_string,
readInt = codec.readInt;

function debug(prefix, buf, start, end) {
    console.log(prefix + ' ' + buf_to_string(buf, start, end));
}

function EPMD(host, port) {

    //    EventEmitter.call(this);
    this.host = host || "localhost";
    this.port = port || 4369;
}

(function(E) {

    var P = E.prototype;
    
    // kont :: epmd x nodeArgs -> () ;; doesn't return
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
            var resp = decode_resp(data);
            //assert(resp[0]=='alive2_resp');
            //assert(resp[1]==0);
            nodeArgs = {'creation': resp[2], 'name': nodename, 'port': port};
            kont(this, nodeArgs);
        });
    }
})(EPMD);

// Write the length of the req in the first two bytes
function writeLength(buf, length) {
    writeInt(buf, length, 0, 2);
}

function send_req(buf, conn, start, end) {
    debug('Sending', buf, start, end);
    var slice = buf.slice(start, end);
    conn.write(slice);
}

function send_alive2_req(sendbuf, conn, nodename, port) {
    var length = 13 + nodename.length;
    writeLength(sendbuf, length);
    var offset = 2;
    sendbuf[offset++] = ALIVE2_REQ;
    writeInt(sendbuf, port, offset, 2); offset +=2;
    sendbuf[offset++] = NOT_HIDDEN;
    sendbuf[offset++] = PROTOCOL;
    writeInt(sendbuf, HIGHEST_VERSION, offset, 2); offset += 2;
    writeInt(sendbuf, LOWEST_VERSION, offset, 2); offset += 2;
    writeInt(sendbuf, nodename.length, offset, 2); offset += 2;
    writeString(sendbuf, nodename, offset); offset += nodename.length;
    // no extra.  what would it be?
    writeInt(sendbuf, 0, offset, 2); offset +=2 ;
    send_req(sendbuf, conn, 0, offset);
}

function decode_resp(buf) {
    debug('Recv', buf, 0, buf.length);
    var respCode = readInt(buf, 0, 1);
    switch (respCode) {
    case ALIVE2_RESP:
        var result = readInt(buf, 1, 1);
        var creation = readInt(buf, 2, 2);
        return ['alive2_resp', result, creation];
    }
}

/*
new EPMD({}).register('node1', 5555,
                      function(epmd, args) {
                          console.log(args.creation);
                      });
*/

exports.EPMD = EPMD;
