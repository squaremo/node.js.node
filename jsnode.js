// The aim here is to support the distribution protocol

var net = require('net');

function node(port) {
    var dist = net.createServer(function(stream) {
        stream.on('connect', function() {
            console.log('Connected ' + stream.remoteAddress);
        });
        stream.on('data', function(data) {
            console.log('Data from ' + stream.remoteAddress +'\n');
            console.log(data);
        });
        stream.on('end', function() {
            console.log('Closed ' + stream.remoteAddress);
        });
    });
    dist.listen(port);
}

// DEMO

var epmd = new (require('./epmd').EPMD)({});
epmd.register('node2', 9999, function(epmd, args) {
    node(9999);
});

