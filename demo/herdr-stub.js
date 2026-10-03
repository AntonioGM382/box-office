// A herdr that is not there: the demo office must not look at (or type into) your real terminals.
// server.js runs this in place of `herdr` when HERDR_STUB points at it; it fails every call, like a machine without herdr.
process.stderr.write('herdr is not available in the demo
');
process.exit(1);
