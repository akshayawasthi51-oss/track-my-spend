
FROM gcc:13

WORKDIR /app

COPY src/ ./src/
COPY data/ ./data/

RUN g++ -std=c++17 -O2 -pthread src/main.cpp -o track-my-spend

EXPOSE 8080

CMD ["./track-my-spend"]
