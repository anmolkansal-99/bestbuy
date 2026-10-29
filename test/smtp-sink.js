import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';

/** Local SMTP server that records every message, so tests exercise the real nodemailer path. */
export function startSink() {
  const sink = {
    messages: [],
    refuse: false,
    port: 0,
    close: () => new Promise((resolve) => server.close(resolve)),
  };

  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS', 'AUTH'],
    logger: false,
    onConnect(session, callback) {
      if (sink.refuse) return callback(new Error('Service temporarily unavailable'));
      return callback();
    },
    onData(stream, session, callback) {
      simpleParser(stream).then(
        (message) => {
          sink.messages.push(message);
          callback();
        },
        (err) => callback(err),
      );
    },
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      sink.port = server.server.address().port;
      resolve(sink);
    });
  });
}
