package com.xiaofeiyu.app;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import android.util.Log;

/**
 * App 内嵌本地代理：WebView 的跨域请求先发到 127.0.0.1:8788，
 * 由这里转发到真实 API（流式透传 + 补 CORS 头），解决 WebView 里第三方接口的 CORS 限制。
 *
 * 支持：
 * - POST /proxy      用 X-DS-Target 指定完整目标 URL（Anthropic / OpenAI / 标题 / 记忆请求）
 * - POST /api/chat   用 X-DS-Base 指定 OpenAI 兼容 base（设置里勾了“本地代理”时）
 * - GET  /api/models 用 X-DS-Base 校验 Key
 * - OPTIONS 预检
 */
public final class LocalProxy {
  private static final int PORT = 8788;
  private static final int MAX_BODY = 64 * 1024 * 1024;
  private static volatile boolean running = false;
  private static ServerSocket server;
  private static ExecutorService pool;

  private LocalProxy() {}

  public static synchronized void start() {
    if (running) return;
    try {
      server = new ServerSocket();
      server.setReuseAddress(true);
      server.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), PORT));
      pool = Executors.newCachedThreadPool();
      running = true;
      Thread accept = new Thread(() -> {
        while (running) {
          try {
            Socket socket = server.accept();
            pool.submit(() -> handle(socket));
          } catch (IOException error) {
            if (running) {
              // 端口被占用等情况：静默退出，App 主流程不受影响
              running = false;
            }
          }
        }
      }, "xfy-proxy-accept");
      accept.setDaemon(true);
      accept.start();
    } catch (IOException error) {
      running = false;
    }
  }

  public static synchronized void stop() {
    running = false;
    try {
      if (server != null) server.close();
    } catch (IOException ignored) {}
    if (pool != null) pool.shutdownNow();
  }

  private static void handle(Socket socket) {
    try (Socket client = socket) {
      client.setSoTimeout(180000);
      BufferedInputStream input = new BufferedInputStream(client.getInputStream());
      String requestLine = readLine(input);
      if (requestLine == null || requestLine.isEmpty()) return;
      String[] parts = requestLine.split(" ");
      if (parts.length < 2) return;
      String method = parts[0];
      String path = parts[1];

      Map<String, String> headers = new LinkedHashMap<>();
      String line;
      while ((line = readLine(input)) != null && !line.isEmpty()) {
        int index = line.indexOf(':');
        if (index > 0) {
          headers.put(line.substring(0, index).trim().toLowerCase(Locale.ROOT), line.substring(index + 1).trim());
        }
      }

      if ("OPTIONS".equalsIgnoreCase(method)) {
        writePreflight(client);
        return;
      }

      byte[] body = readBody(input, headers);
      String target = resolveTarget(path, headers);
      Log.d("XFYProxy", method + " " + path + " -> " + target);
      if (target == null) {
        writeJsonError(client, 400, "缺少目标地址（X-DS-Target / X-DS-Base）");
        return;
      }
      forward(client, method, target, headers, body);
    } catch (Exception error) {
      try {
        writeJsonError(socket, 502, error.getMessage() == null ? error.toString() : error.getMessage());
      } catch (Exception ignored) {}
    }
  }

  private static String resolveTarget(String path, Map<String, String> headers) {
    if (path.startsWith("/proxy")) {
      return headers.get("x-ds-target");
    }
    String base = headers.get("x-ds-base");
    String trimmed = base == null ? null : base.replaceAll("/+$", "");
    if (path.equals("/api/chat")) {
      return (trimmed == null ? "https://api.deepseek.com/v1" : trimmed) + "/chat/completions";
    }
    if (path.equals("/api/models")) {
      return (trimmed == null ? "https://api.deepseek.com" : trimmed) + "/models";
    }
    return null;
  }

  private static void forward(
      Socket client,
      String method,
      String target,
      Map<String, String> headers,
      byte[] body
  ) throws IOException {
    URL url = new URL(target);
    String protocol = url.getProtocol();
    if (!"http".equals(protocol) && !"https".equals(protocol)) {
      throw new IOException("只支持 http/https 目标");
    }

    HttpURLConnection connection = (HttpURLConnection) url.openConnection();
    connection.setRequestMethod(method);
    connection.setConnectTimeout(30000);
    connection.setReadTimeout(180000);
    connection.setDoInput(true);
    connection.setInstanceFollowRedirects(true);

    for (Map.Entry<String, String> entry : headers.entrySet()) {
      String key = entry.getKey();
      if (key.equals("host") || key.equals("content-length") || key.equals("connection")
          || key.equals("accept-encoding") || key.equals("origin") || key.equals("referer")
          || key.equals("transfer-encoding") || key.equals("expect") || key.startsWith("x-ds-")) {
        continue;
      }
      connection.setRequestProperty(entry.getKey(), entry.getValue());
    }

    if (body != null && body.length > 0) {
      connection.setDoOutput(true);
      try (OutputStream out = connection.getOutputStream()) {
        out.write(body);
      }
    }

    int status;
    Log.d("XFYProxy", "forwarding " + method + " " + target);
    try {
      status = connection.getResponseCode();
    } catch (IOException error) {
      writeJsonError(client, 502, "上游连接失败：" + error.getMessage());
      return;
    }
    InputStream upstream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();

    OutputStream out = client.getOutputStream();
    String contentType = connection.getContentType();
    StringBuilder head = new StringBuilder();
    head.append("HTTP/1.1 ").append(status).append(' ')
        .append(connection.getResponseMessage() == null ? "OK" : connection.getResponseMessage())
        .append("\r\n");
    head.append("Content-Type: ").append(contentType == null ? "application/json" : contentType).append("\r\n");
    head.append("Access-Control-Allow-Origin: *\r\n");
    head.append("Access-Control-Allow-Headers: *\r\n");
    head.append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
    head.append("Access-Control-Expose-Headers: *\r\n");
    head.append("Access-Control-Allow-Private-Network: true\r\n");
    head.append("Cache-Control: no-cache\r\n");
    head.append("Transfer-Encoding: chunked\r\n");
    head.append("Connection: close\r\n\r\n");
    out.write(head.toString().getBytes(StandardCharsets.UTF_8));
    out.flush();

    if (upstream != null) {
      byte[] buffer = new byte[4096];
      int read;
      while ((read = upstream.read(buffer)) != -1) {
        out.write(Integer.toHexString(read).getBytes(StandardCharsets.US_ASCII));
        out.write("\r\n".getBytes(StandardCharsets.US_ASCII));
        out.write(buffer, 0, read);
        out.write("\r\n".getBytes(StandardCharsets.US_ASCII));
        out.flush();
      }
      upstream.close();
    }
    out.write("0\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
    out.flush();
    connection.disconnect();
  }

  private static void writePreflight(Socket client) throws IOException {
    OutputStream out = client.getOutputStream();
    String response = "HTTP/1.1 204 No Content\r\n"
        + "Access-Control-Allow-Origin: *\r\n"
        + "Access-Control-Allow-Headers: authorization,content-type,x-ds-target,x-ds-base,x-api-key,anthropic-version,accept\r\n"
        + "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        + "Access-Control-Allow-Private-Network: true\r\n"
        + "Access-Control-Max-Age: 600\r\n"
        + "Content-Length: 0\r\n"
        + "Connection: close\r\n\r\n";
    out.write(response.getBytes(StandardCharsets.UTF_8));
    out.flush();
  }

  private static void writeJsonError(Socket client, int status, String message) throws IOException {
    String safe = message == null ? "" : message.replace("\\", "\\\\").replace("\"", "\\\"");
    byte[] body = ("{\"error\":{\"message\":\"" + safe + "\"}}").getBytes(StandardCharsets.UTF_8);
    OutputStream out = client.getOutputStream();
    String head = "HTTP/1.1 " + status + " Error\r\n"
        + "Content-Type: application/json; charset=utf-8\r\n"
        + "Access-Control-Allow-Origin: *\r\n"
        + "Content-Length: " + body.length + "\r\n"
        + "Connection: close\r\n\r\n";
    out.write(head.getBytes(StandardCharsets.UTF_8));
    out.write(body);
    out.flush();
  }

  private static String readLine(InputStream input) throws IOException {
    ByteArrayOutputStream buffer = new ByteArrayOutputStream();
    int current;
    boolean any = false;
    while ((current = input.read()) != -1) {
      any = true;
      if (current == '\n') break;
      if (current != '\r') buffer.write(current);
    }
    if (!any) return null;
    return buffer.toString(StandardCharsets.UTF_8.name());
  }

  private static byte[] readBody(InputStream input, Map<String, String> headers) throws IOException {
    String lengthHeader = headers.get("content-length");
    if (lengthHeader == null) return new byte[0];
    int length;
    try {
      length = Integer.parseInt(lengthHeader.trim());
    } catch (NumberFormatException error) {
      return new byte[0];
    }
    if (length <= 0 || length > MAX_BODY) return new byte[0];
    byte[] body = new byte[length];
    int offset = 0;
    while (offset < length) {
      int read = input.read(body, offset, length - offset);
      if (read < 0) break;
      offset += read;
    }
    return body;
  }
}