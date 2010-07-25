This is going to be a library for running an Erlang (hidden) node
in node.js.

To do this needs:

 * The Erlang Port Mapper Daemon protocol
 * A binary term format codec
 * The distribution protocol
 * Some idiomatic mapping of the commands coming from the previous

The first three aren't very tricky.  The last isn't totally obvious,
so it's going to be a bit experimental for a while ..
