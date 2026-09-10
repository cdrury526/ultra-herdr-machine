/* Test-only Linux interposer: stop our child at its selected atomic publication. */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>

static void stop_at(const char *destination, const char *stage) {
    const char *selected = getenv("ULTRA_TEST_PUBLISH_PATH");
    const char *when = getenv("ULTRA_TEST_PUBLISH_STAGE");
    if (selected && when && !strcmp(selected, destination) && !strcmp(when, stage))
        raise(SIGSTOP);
}
int rename(const char *source, const char *destination) {
    int (*actual)(const char *, const char *) = dlsym(RTLD_NEXT, "rename");
    stop_at(destination, "before");
    int result = actual(source, destination);
    if (!result) stop_at(destination, "after");
    return result;
}
int renameat(int source_fd, const char *source, int destination_fd, const char *destination) {
    int (*actual)(int, const char *, int, const char *) = dlsym(RTLD_NEXT, "renameat");
    stop_at(destination, "before");
    int result = actual(source_fd, source, destination_fd, destination);
    if (!result) stop_at(destination, "after");
    return result;
}
int renameat2(int source_fd, const char *source, int destination_fd, const char *destination, unsigned int flags) {
    int (*actual)(int, const char *, int, const char *, unsigned int) = dlsym(RTLD_NEXT, "renameat2");
    stop_at(destination, "before");
    int result = actual(source_fd, source, destination_fd, destination, flags);
    if (!result) stop_at(destination, "after");
    return result;
}
