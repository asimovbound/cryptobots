{pkgs}: {
  deps = [
    pkgs.zip
    pkgs.wget
    pkgs.ollama
    pkgs.glibcLocales
    pkgs.postgresql
  ];
}
