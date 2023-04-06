$(document).ready(function () {
    $('#clientSecret').change(() => {
      jQuery.ajax({
        url: 'api/aps/credentials',
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({
            client_id: $('#clientId').val(),
            client_secret: $('#clientSecret').val()
        }),
        success: function (res) {
            writeLog('Client Id & Client Secret are valid!');
            prepareLists();

            $('#clearAccount').click(clearAccount);
            $('#defineActivityShow').click(defineActivityModal);
            $('#createActivity').click(startCreatingActivity);
            $('#startWorkitem').click(startWorkitem);
        
            startConnection();
        },
        error: function (xhr, ajaxOptions, thrownError) {
            writeLog('Something wrong with Client Id or Client Secret!');
        }
      });
    });
});



function prepareLists() {
    list(['activity'], '/api/aps/designautomation/activities');
    list(['engines'], '/api/aps/designautomation/engines');
    list(['inputFile', 'outputFile'], '/api/aps/datamanagement/objects');
}

function list(controls, endpoint) {
      jQuery.ajax({
          url: endpoint,
          success: function (list) {
            controls.forEach(function (control) {
              $('#' + control).find('option').remove().end();
              if (list.length === 0) {
                  $('#' + control).append($('<option>', {
                      disabled: true,
                      text: 'Nothing found'
                  }));
              }
              else
                  list.forEach(function (item) {
                      $('#' + control).append($('<option>', {
                          value: item,
                          text: item
                      }));
                  });
            });
          },
          error: function (xhr, ajaxOptions, thrownError) {
            writeLog(xhr.responseJSON.message);
        }
      });
}

function clearAccount() {
    if (!confirm('Clear existing app bundles & activities before start. ' +
        'This is useful if you believe there are wrong settings on your account.' +
        '\n\nYou cannot undo this operation. Proceed?'))
        return;

    jQuery.ajax({
        url: 'api/aps/designautomation/account',
        method: 'DELETE',
        success: function () {
            prepareLists();
            writeLog('Account cleared, all app bundles & activities deleted');
        }
    });
}

function defineActivityModal() {
    $("#defineActivityModal").modal();
}

function startCreatingActivity() {
    startConnection(function () {
        writeLog("Defining activity for " + $('#engines').val());
        $("#defineActivityModal").modal('toggle');
          createActivity(function () {
              prepareLists();
          });
    });
}

function createActivity(cb) {
    jQuery.ajax({
        url: 'api/aps/designautomation/activities',
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({
            engine: $('#engines').val()
        }),
        success: function (res) {
            writeLog('Activity: ' + res.activity);
            if (cb)
                cb();
        },
        error: function (xhr, ajaxOptions, thrownError) {
            writeLog(' -> ' + (xhr.responseJSON && xhr.responseJSON.diagnostic ? xhr.responseJSON.diagnostic : thrownError));
        }
    });
}

function startWorkitem() {
  if ($('#activity').val() === '')
    return (alert('Please select an activity'));

    if ($('#inputFile').val() === '' || $('#inputCode').val() === '')
      return (alert('Please provide both an input file and an iLogic file'));

    var inputCode = document.getElementById('inputCode');

    var file = inputCode.files[0];
    startConnection(function () {
        var formData = new FormData();
        formData.append('inputCode', file);
        formData.append('data', JSON.stringify({
            inputFile: $('#inputFile').val(),
            outputFile: $('#outputFile').val(),
            activityName: $('#activity').val(),
            browserConnectionId: connectionId
        }));
        writeLog('Uploading input file...');
        $.ajax({
            url: 'api/aps/designautomation/workitems',
            data: formData,
            processData: false,
            contentType: false,
            //contentType: 'multipart/form-data',
            //dataType: 'json',
            type: 'POST',
            success: function (res) {
                writeLog('Workitem started: ' + res.workItemId);
            },
            error: function (xhr, ajaxOptions, thrownError) {
                writeLog(' -> ' + (xhr.responseJSON && xhr.responseJSON.diagnostic ? xhr.responseJSON.diagnostic : thrownError));
            },
            complete: function (data) {
              $('#inputCode').val(""); // this will reset the form fields
            }
        });
    });
}

function writeLog(text) {
    $('#outputlog').append('<div style="border-top: 1px dashed #C0C0C0">' + text + '</div>');
    var elem = document.getElementById('outputlog');
    elem.scrollTop = elem.scrollHeight;
}

var connection;
var connectionId;

function startConnection(onReady) {
    if (connection && connection.connected) {
        if (onReady)
            onReady();
        return;
    }
    connection = io();
    connection.on('connect', function () {
        connectionId = connection.id;
        if (onReady)
            onReady();
    });

    connection.on('downloadResult', function (url) {
        writeLog('<a href="' + url + '">Download result file here</a>');
    });

    connection.on('downloadReport', function (url) {
        writeLog('<a href="' + url + '">Download report file here</a>');
    });

    connection.on('onComplete', function (message) {
        if (typeof message === 'object')
            message = JSON.stringify(message, null, 2);
        writeLog(message);
    });
}
