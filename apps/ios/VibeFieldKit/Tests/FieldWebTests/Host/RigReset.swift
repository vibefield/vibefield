import Foundation

/// SP-4c's rig — W4's far side that FAILS after the tunnel is made: a plain TCP listener on 127.0.0.1 that accepts
/// ONE connection, waits 200 ms, and resets it (SO_LINGER 0), so the stand-in's upstream goes `.failed` after
/// `.ready`. It reads nothing and sends nothing. Its thread ends after that one connection, or after 5 s with none.
enum RigReset {
  /// Starts the listener and answers its port.
  static func start() throws -> UInt16 {
    let listening = socket(AF_INET, SOCK_STREAM, 0)
    guard listening >= 0 else { throw URLError(.cannotConnectToHost) }
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = 0
    address.sin_addr.s_addr = inet_addr("127.0.0.1")
    var length = socklen_t(MemoryLayout<sockaddr_in>.size)
    let bound = withUnsafeMutablePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socket in
        guard bind(listening, socket, length) == 0 else { return false }
        return getsockname(listening, socket, &length) == 0
      }
    }
    guard bound, listen(listening, 1) == 0 else {
      close(listening)
      throw URLError(.cannotConnectToHost)
    }
    let port = UInt16(bigEndian: address.sin_port)
    var bound4 = address.sin_addr
    RigListen.say("reset", address: RigListen.text(AF_INET, withUnsafeBytes(of: &bound4) { Data($0) }))
    Thread.detachNewThread {
      var waiting = pollfd(fd: listening, events: Int16(POLLIN), revents: 0)
      if poll(&waiting, 1, 5_000) > 0 {
        let peer = accept(listening, nil, nil)
        if peer >= 0 {
          usleep(200_000)
          var abort = linger(l_onoff: 1, l_linger: 0)
          _ = setsockopt(peer, SOL_SOCKET, SO_LINGER, &abort, socklen_t(MemoryLayout<linger>.size))
          close(peer)
        }
      }
      close(listening)
    }
    return port
  }
}
