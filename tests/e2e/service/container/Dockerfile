FROM lambci/lambda:build-python2.7

ENV XDG_CACHE_HOME /cache
RUN git clone https://github.com/stackstorm/st2 /dist/st2
RUN git clone https://github.com/stackstorm-exchange/stackstorm-test /dist/stackstorm-test
RUN mkdir -p /tmp/pkgs \
    && pip download --dest /tmp/pkgs -r /dist/st2/st2common/requirements.txt \
      -r /dist/st2/contrib/runners/python_runner/requirements.txt \
      -r /dist/stackstorm-test/requirements.txt \
    && rm -R /tmp/pkgs
