package com.example.udprtt

import android.os.Bundle
import android.util.Log
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.*
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException

class MainActivity : AppCompatActivity() {

    private lateinit var etIpAddress: EditText
    private lateinit var etPort: EditText
    private lateinit var etInterval: EditText
    private lateinit var etPacketSize: EditText
    private lateinit var btnStart: Button
    private lateinit var btnStop: Button
    private lateinit var tvStatus: TextView
    private lateinit var tvLog: TextView

    private var pingJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.Main + Job())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        etIpAddress = findViewById(R.id.etIpAddress)
        etPort = findViewById(R.id.etPort)
        etInterval = findViewById(R.id.etInterval)
        etPacketSize = findViewById(R.id.etPacketSize)
        btnStart = findViewById(R.id.btnStart)
        btnStop = findViewById(R.id.btnStop)
        tvStatus = findViewById(R.id.tvStatus)
        tvLog = findViewById(R.id.tvLog)

        btnStart.setOnClickListener {
            startPing()
        }

        btnStop.setOnClickListener {
            stopPing()
        }
    }

    private fun startPing() {
        val ip = etIpAddress.text.toString()
        val portStr = etPort.text.toString()

        if (ip.isBlank() || portStr.isBlank()) {
            appendLog("Invalid IP or Port")
            return
        }

        val port = portStr.toIntOrNull() ?: 50000
        val interval = etInterval.text.toString().toLongOrNull() ?: 1000L
        val packetSize = etPacketSize.text.toString().toIntOrNull() ?: 64

        btnStart.isEnabled = false
        btnStop.isEnabled = true
        etIpAddress.isEnabled = false
        etPort.isEnabled = false
        etInterval.isEnabled = false
        etPacketSize.isEnabled = false
        tvStatus.text = "Status: Pinging..."

        pingJob = scope.launch(Dispatchers.IO) {
            var socket: DatagramSocket? = null
            try {
                socket = DatagramSocket()
                socket.soTimeout = 1000 // 1 second timeout
                val address = InetAddress.getByName(ip)
                val buffer = ByteArray(65535) // Large buffer for receive
                var seq = 0

                while (isActive) {
                    seq++
                    val message = "PING $seq"
                    val messageBytes = message.toByteArray()
                    val sendData = ByteArray(packetSize)
                    if (messageBytes.size <= packetSize) {
                        System.arraycopy(messageBytes, 0, sendData, 0, messageBytes.size)
                    } else {
                        System.arraycopy(messageBytes, 0, sendData, 0, packetSize)
                    }
                    val sendPacket = DatagramPacket(sendData, sendData.size, address, port)

                    val startTime = System.currentTimeMillis()
                    try {
                        socket.send(sendPacket)

                        val receivePacket = DatagramPacket(buffer, buffer.size)
                        socket.receive(receivePacket)

                        val endTime = System.currentTimeMillis()
                        val rtt = endTime - startTime

                        val receivedData = String(receivePacket.data, 0, receivePacket.length)

                        withContext(Dispatchers.Main) {
                            appendLog("#$seq: RTT=${rtt}ms ($receivedData)")
                        }
                    } catch (e: SocketTimeoutException) {
                         withContext(Dispatchers.Main) {
                            appendLog("#$seq: Timeout")
                        }
                    } catch (e: Exception) {
                        withContext(Dispatchers.Main) {
                            appendLog("#$seq: Error - ${e.message}")
                        }
                    }

                    delay(interval) // Wait specified interval
                }

            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    appendLog("Socket Error: ${e.message}")
                    stopPing()
                }
            } finally {
                socket?.close()
            }
        }
    }

    private fun stopPing() {
        pingJob?.cancel()
        pingJob = null

        btnStart.isEnabled = true
        btnStop.isEnabled = false
        etIpAddress.isEnabled = true
        etPort.isEnabled = true
        etInterval.isEnabled = true
        etPacketSize.isEnabled = true
        tvStatus.text = "Status: Stopped"
        appendLog("Stopped.")
    }

    private fun appendLog(message: String) {
        val currentText = tvLog.text.toString()
        val newText = "$message\n$currentText"
        // Keep log size manageable
        tvLog.text = if (newText.length > 5000) newText.substring(0, 5000) else newText
    }

    override fun onDestroy() {
        super.onDestroy()
        pingJob?.cancel()
    }
}
