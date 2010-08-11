// The aim here is to support the distribution protocol

var net = require('net');
var EventEmitter = require('events').EventEmitter;
var EPMD = require('./epmd').EPMD;

var buf_to_string = require('./etf').buf_to_string;

function Dist(nodename, port) {
    
    EventEmitter.call(this);
    this._name = nodename;
    this._port = port;

}

(function(D) {
    var P = D.prototype = new EventEmitter();

    P.create = function() {
        var epmd = new EPMD({});
        var node = this;
        epmd.register(
            node._name, node._port,
            function(epmd, args) {
                node.emit('registered');
                var dist = net.createServer(function(stream) {
                    stream.on('connect', function() {
                        node.emit('newConnection', stream);
                    });
                    stream.on('data', function(data) {
                        node.emit('data', stream, data);
                    });
                    stream.on('end', function() {
                        node.emit('endConnection' + stream);
                    });
                });
                dist.listen(node._port);
            });
    };
}(Dist));

// DEMO

var n = new Dist('node3', 12345);
n.on('newConnection', function(stream) {
    console.log('New connection: ' + stream.remoteAddress);
});
n.on('data', function(stream, data) {
    console.log('From ' + stream.remoteAddress +': ' + buf_to_string(data));
});
n.on('endConnection', function(stream) {
    connnection.log('End connection: ' + stream.remoteAddress);
});

n.create();
