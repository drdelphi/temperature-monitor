CC ?= gcc
CFLAGS ?= -std=c11 -Wall -Wextra -O2 -I../main
LDLIBS ?= -lm

.PHONY: all test clean

all: test

test: test_pack test_adc_filter
	./test_pack
	./test_adc_filter

test_pack: test_pack.c ../main/pack.c ../main/pack.h
	$(CC) $(CFLAGS) -o $@ test_pack.c ../main/pack.c $(LDLIBS)

test_adc_filter: test_adc_filter.c ../main/adc_filter.c ../main/adc_filter.h
	$(CC) $(CFLAGS) -o $@ test_adc_filter.c ../main/adc_filter.c $(LDLIBS)

clean:
	rm -f test_pack test_adc_filter
