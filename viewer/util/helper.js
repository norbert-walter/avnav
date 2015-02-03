/**
 * Created by andreas on 04.05.14.
 */
avnav.provide('avnav.util.Helper');


/**
 *
 * @constructor
 */
avnav.util.Helper=function(){};

/**
 * @param url {string}
 * @param file {File}
 * @param param parameter object
 *        all handlers get the param object as first parameter
 *        progresshandler: progressfunction
 *        okhandler: called when done
 *        errorhandler: called on error
 *        see https://mobiarch.wordpress.com/2012/08/21/html5-file-upload-with-progress-bar-using-jquery/
 */
avnav.util.Helper.uploadFile=function(url,file,param){
    try {
        $.ajax({
            url: url,
            type: "POST",
            data: file,
            processData: false, //Work around #1
            contentType: file.type, //Work around #2
            beforeSend: function(xhdr,settings){
                settings.data=file; //workaround for safari - see http://www.redmine.org/issues/13932
            },
            success: function (data) {
                if (param.okhandler) {
                    param.okhandler(param, data);
                }
            },
            error: function (err) {
                if (param.errorhandler) {
                    param.errorhandler(param, err);
                }
            },
            //Work around #3
            xhr: function () {
                myXhr = $.ajaxSettings.xhr();
                if (myXhr.upload && param.progresshandler) {
                    myXhr.upload.addEventListener('progress', function (ev) {
                        param.progresshandler(param, ev);
                    }, false);
                }
                return myXhr;
            }
        });
    }catch (e){
        alert("upload error: "+e);
    }
};

