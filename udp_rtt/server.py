import socket
import sys

def run_server(host='0.0.0.0', port=50000):
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.bind((host, port))
        print(f"UDP Echo Server listening on {host}:{port}")

        while True:
            data, addr = sock.recvfrom(65535)
            # print(f"Received {len(data)} bytes from {addr}")
            # Echo back immediately
            sock.sendto(data, addr)

    except KeyboardInterrupt:
        print("\nStopping server...")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        sock.close()

if __name__ == "__main__":
    port_to_use = 50000
    if len(sys.argv) > 1:
        try:
            port_to_use = int(sys.argv[1])
        except ValueError:
            print(f"Usage: python3 server.py [port]")
            sys.exit(1)

    run_server(port=port_to_use)
