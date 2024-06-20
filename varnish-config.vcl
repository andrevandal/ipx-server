vcl 4.1;

import std;
import directors;

backend backend1 {
  .host = "ipx-1";
  .port = "3000";
}

backend backend2 {
  .host = "ipx-2";
  .port = "3000";
}

backend backend3 {
  .host = "ipx-3";
  .port = "3000";
}

sub vcl_init {
  new vdir = directors.round_robin();
  vdir.add_backend(backend1);
  vdir.add_backend(backend2);
  vdir.add_backend(backend3);    
}

sub vcl_recv {
  set req.http.grace = "none";
  set req.backend_hint = vdir.backend();
  if (req.url ~ "^/") {
    return (hash);
  }
}

sub vcl_backend_response {
  set beresp.ttl = 1w;
  set beresp.grace = 2w;
}

sub vcl_deliver {
  set resp.http.grace = req.http.grace;
}