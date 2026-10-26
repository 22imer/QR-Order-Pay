location /api/ {
  client_max_body_size 4m;
  limit_req zone=guest_api_per_session burst=30 nodelay;
  limit_req_status 429;
  limit_conn guest_connections_per_session 20;
  limit_conn_status 429;
  proxy_pass http://maycafe_guest_api;
  proxy_http_version 1.1;
  proxy_connect_timeout 1s;
  proxy_read_timeout 20s;
  proxy_next_upstream error timeout http_502 http_503 http_504;
  proxy_next_upstream_tries 2;
  proxy_set_header Host $http_host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}

location /socket.io/ {
  limit_conn guest_connections_per_session 4;
  limit_conn_status 429;
  proxy_pass http://maycafe_guest_socket;
  proxy_http_version 1.1;
  proxy_connect_timeout 1s;
  proxy_next_upstream error timeout http_502 http_503 http_504;
  proxy_next_upstream_tries 2;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $http_host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 65s;
}
